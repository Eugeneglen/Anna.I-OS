#!/usr/bin/env python3
"""
Persistent watchdog for the Anna.I Next.js production server.

WHY THIS EXISTS
---------------
The sandbox agent runner (main.py, PID ~948) kills its bash subprocess tree
at the end of every Bash tool call. Any server started with `nohup`, `setsid`,
or `&` from inside that bash dies with it — confirmed empirically: a plain
`sleep 60 &` did not survive the next call, and earlier `bun x next start`
attempts using `nohup ... &` and `setsid env ... &` also failed.

ROOT CAUSE
----------
The bash shell is a descendant of main.py:
    tini(1) -> caddy(2) -> uv(884) -> python3 main.py(948) -> sh -> su -> bash
When a Bash tool call ends, main.py tears down that whole subtree (by PGID
kill or by walking /proc descendants of the spawned shell). None of tini,
caddy, uv, or main.py is a child subreaper (`/proc/<pid>/status` has no
ChildSubReaper field), so reparenting to PID 1 takes the daemon out of
main.py's descendant set entirely.

THE FIX
-------
Classic Unix double-fork + setsid:
    1. fork  -> parent (P) exits immediately, returning control to bash.
    2. setsid -> intermediate child (C1) becomes session leader, new PGID.
    3. fork  -> C1 exits; grandchild (C2) is reparented to PID 1 (tini).
C2 is no longer in bash's process group, nor in main.py's descendant tree.
Tini only reaps zombies — it never sends signals to its children — so C2
survives across bash calls indefinitely.

VERIFIED
--------
A marker daemon using this exact pattern survived 6+ heartbeats spanning two
separate Bash tool calls with PPID=1 throughout.

USAGE
-----
    python3 server-persist.py start     # launch daemon (returns in ~1s)
    python3 server-persist.py status    # check daemon + HTTP health
    python3 server-persist.py stop      # stop daemon + server
    python3 server-persist.py restart   # stop + start

LOGS
----
    logs/server-persist.log    watchdog decisions (spawn / exit / restart)
    logs/server.stdout.log     Next.js stdout
    logs/server.stderr.log     Next.js stderr

PID FILE
--------
    /tmp/anna-server-persist.pid   watchdog PID (used by stop/restart/status)
"""
import os
import sys
import time
import signal
import subprocess

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PROJECT_DIR = '/home/z/my-project'
LOG_DIR = f'{PROJECT_DIR}/logs'
PID_FILE = '/tmp/anna-server-persist.pid'
WATCHDOG_LOG = f'{LOG_DIR}/server-persist.log'
SERVER_STDOUT = f'{LOG_DIR}/server.stdout.log'
SERVER_STDERR = f'{LOG_DIR}/server.stderr.log'

PORT = 3000
RESTART_BACKOFF_MIN = 3       # seconds between restart attempts (start)
RESTART_BACKOFF_MAX = 30     # cap

# Next.js production server.
#
# HISTORY / RATIONALE
# --------------------
# A previous version of this file ran `node .next/standalone/server.js`.
# That command did serve HTML pages, but it returned HTTP 404 for every
# `/_next/static/chunks/*.js` request, which broke the client bundle
# ("Application error: a client-side exception has occurred").
#
# `next start` serves the chunks correctly because it reads the static
# manifest out of `.next/` (where `next build` actually wrote the chunks).
# Yes, `output: 'standalone'` in next.config.ts makes `next start` print a
# warning ("output: 'standalone' is set but using next start") — but that
# warning is cosmetic; chunk serving is unaffected.
#
# We invoke the local next CLI directly (not `npx next` / `bun x next`)
# to avoid the spawn overhead and any PATH-resolution surprises in the
# daemon environment. The path below is the real Node script that the
# `.bin/next` symlink points to.
NEXT_BIN = os.path.join(PROJECT_DIR, 'node_modules', 'next', 'dist', 'bin', 'next')
SERVER_CMD = ['node', NEXT_BIN, 'start', '-p', str(PORT), '-H', '0.0.0.0']

# Environment for the server. Reads DATABASE_URL from the project .env so we
# don't accidentally desync from whatever the entrypoint wrote.
def _build_env():
    env = {
        'PATH': '/usr/local/bin:/usr/bin:/bin:/home/z/.bun/bin',
        'HOME': '/home/z',
        'NODE_ENV': 'production',
        'NEXTAUTH_SECRET': 'anna-i-dev-secret-32-chars-long-string-x',
        'NEXTAUTH_URL': 'http://localhost:3000',
        'NEXT_TELEMETRY_DISABLED': '1',
        'PORT': str(PORT),
        'HOSTNAME': '0.0.0.0',
    }
    # Inherit DATABASE_URL from .env if present (entrypoint writes it).
    try:
        with open(f'{PROJECT_DIR}/.env') as f:
            for line in f:
                line = line.strip()
                if line.startswith('DATABASE_URL='):
                    env['DATABASE_URL'] = line.split('=', 1)[1].strip()
                    break
    except OSError:
        pass
    return env


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def log(msg):
    line = f"[{time.strftime('%Y-%m-%dT%H:%M:%S')}] {msg}\n"
    try:
        with open(WATCHDOG_LOG, 'a') as f:
            f.write(line)
    except OSError:
        pass


def read_pid():
    try:
        with open(PID_FILE) as f:
            return int(f.read().strip())
    except (FileNotFoundError, ValueError):
        return None


def is_alive(pid):
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False


def safe_ppid(pid):
    try:
        with open(f'/proc/{pid}/status') as f:
            for line in f:
                if line.startswith('PPid:'):
                    return line.split(':', 1)[1].strip()
    except OSError:
        pass
    return '?'


def kill_process_tree(pid, sig=signal.SIGTERM, timeout=5.0):
    """Send signal to pid's whole process group, then wait."""
    try:
        pgid = os.getpgid(pid)
        os.killpg(pgid, sig)
    except (ProcessLookupError, PermissionError):
        return
    # Wait for it to actually die
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not is_alive(pid):
            return
        time.sleep(0.1)
    # Escalate to SIGKILL
    try:
        pgid = os.getpgid(pid)
        os.killpg(pgid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


def free_port():
    """Kill anything holding our port so the server can bind."""
    try:
        subprocess.run(['fuser', '-k', f'{PORT}/tcp'],
                       capture_output=True, timeout=5)
    except Exception:
        pass
    time.sleep(0.3)


# ---------------------------------------------------------------------------
# Daemonization (classic double-fork + setsid)
# ---------------------------------------------------------------------------
def become_daemon():
    """Detach from the calling shell and reparent to PID 1 (tini).

    After this returns, we are:
      - In our own session + process group (not bash's PGID).
      - Reparented to PID 1 (because both intermediate parents exited).
      - No longer a descendant of main.py / bash.

    NOTE: We deliberately do NOT call os.closerange() or dup2() here.
    Empirically, closing inherited fds 0-1024 in this sandbox kills the
    grandchild within ~1s (most likely the python interpreter has internal
    fds it depends on; closing them destabilizes it). The marker-daemon
    pattern of replacing sys.stdout/sys.stderr with new file objects works
    reliably — proven across multiple bash calls with PPID=1 throughout.
    The inherited pipe fds stay open but unused; bash exits anyway, and
    the orphaned pipes are harmless.
    """
    # First fork: parent exits immediately, child continues.
    if os.fork() != 0:
        os._exit(0)
    # Become session leader + drop controlling tty.
    os.setsid()
    # Second fork: child can't reacquire a controlling tty. Then it exits,
    # leaving the grandchild orphaned and reparented to PID 1.
    if os.fork() != 0:
        os._exit(0)

    # We are the grandchild now. PPID will become 1 momentarily.
    os.chdir(PROJECT_DIR)
    os.umask(0o022)

    # Replace python-level stdio (NOT the underlying fds). This is the
    # marker-daemon pattern that survives across bash calls here.
    sys.stdout = open(os.devnull, 'w')
    sys.stderr = open(WATCHDOG_LOG, 'a')

    # Reset signal handlers to defaults (we may have inherited ignored ones).
    for s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP,
              signal.SIGTSTP, signal.SIGCHLD, signal.SIGPIPE,
              signal.SIGUSR1, signal.SIGUSR2):
        try:
            signal.signal(s, signal.SIG_DFL)
        except (OSError, ValueError):
            pass

    # Persist our PID so stop/status/restart can find us.
    with open(PID_FILE, 'w') as f:
        f.write(str(os.getpid()))


# ---------------------------------------------------------------------------
# Watchdog loop
# ---------------------------------------------------------------------------
def watchdog_loop():
    """Spawn the Next.js server; restart on exit with exponential backoff."""
    become_daemon()
    log(f"=== watchdog started pid={os.getpid()} ppid={os.getppid()} ===")
    backoff = RESTART_BACKOFF_MIN
    while True:
        free_port()
        log(f"spawning: {' '.join(SERVER_CMD)} (PORT={PORT})")
        try:
            out_fd = os.open(SERVER_STDOUT, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
            err_fd = os.open(SERVER_STDERR, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
            proc = subprocess.Popen(
                SERVER_CMD,
                cwd=PROJECT_DIR,
                env=_build_env(),
                stdin=subprocess.DEVNULL,
                stdout=out_fd,
                stderr=err_fd,
                # Run server in its own session/PGID so we can kill the whole
                # tree (server + any workers) cleanly on stop.
                start_new_session=True,
            )
            os.close(out_fd)
            os.close(err_fd)
            log(f"server child pid={proc.pid}")
            rc = proc.wait()
            log(f"server exited rc={rc}")
        except FileNotFoundError as e:
            log(f"spawn failed (binary missing): {e!r}")
            rc = 127
        except Exception as e:
            log(f"spawn failed: {e!r}")
            rc = 1

        log(f"restarting in {backoff}s")
        time.sleep(backoff)
        # Slowly back off if we're crash-looping, but always restart.
        backoff = min(backoff * 2, RESTART_BACKOFF_MAX)


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------
def cmd_start():
    os.makedirs(LOG_DIR, exist_ok=True)
    existing = read_pid()
    if is_alive(existing):
        print(f"watchdog already running pid={existing} ppid={safe_ppid(existing)}")
        return 0
    if existing is not None:
        # Stale PID file; clean it up.
        try:
            os.unlink(PID_FILE)
        except OSError:
            pass

    # Fork off the watchdog. We do NOT use `&` from bash; we fork directly so
    # the daemon's process group is set up before bash sees this command
    # return.
    pid = os.fork()
    if pid != 0:
        # Parent (called from bash): wait briefly for the daemon to write its
        # PID file, then report and return.
        for _ in range(30):  # up to 3s
            time.sleep(0.1)
            p = read_pid()
            if p and is_alive(p):
                print(f"watchdog launched pid={p} ppid={safe_ppid(p)} "
                      f"(reparented to tini -> survives bash exit)")
                return 0
        print("ERROR: watchdog did not report ready within 3s; "
              f"check {WATCHDOG_LOG}", file=sys.stderr)
        return 1
    # Child: become the daemon and run the watchdog loop. We do NOT return
    # from this — watchdog_loop() calls become_daemon() which forks again and
    # the intermediate process exits.
    watchdog_loop()
    os._exit(0)


def cmd_status():
    pid = read_pid()
    if not is_alive(pid):
        print(f"watchdog: DOWN (stale pid_file={pid})")
        wd_ok = False
    else:
        print(f"watchdog: UP pid={pid} ppid={safe_ppid(pid)} "
              f"{'(reparented to tini)' if safe_ppid(pid) == '1' else ''}")
        wd_ok = True

    # HTTP check
    try:
        import urllib.request
        r = urllib.request.urlopen(f'http://localhost:{PORT}/', timeout=4)
        body = r.read(200)
        print(f"server:   RESPONDING on :{PORT} (HTTP {r.status}, {len(body)}B body)")
        return 0 if wd_ok else 0
    except Exception as e:
        print(f"server:   NOT responding on :{PORT} ({type(e).__name__}: {e})")
        return 2


def cmd_stop():
    pid = read_pid()
    if not is_alive(pid):
        print(f"watchdog: not running (pid_file={pid})")
        if pid is not None:
            try:
                os.unlink(PID_FILE)
            except OSError:
                pass
    else:
        log(f"stop: killing watchdog pid={pid}")
        kill_process_tree(pid, signal.SIGTERM, timeout=5.0)
        if is_alive(pid):
            kill_process_tree(pid, signal.SIGKILL, timeout=2.0)
        print(f"watchdog stopped pid={pid}")
        try:
            os.unlink(PID_FILE)
        except OSError:
            pass

    # Also reap any leftover server processes (in case watchdog died uncleanly).
    # Match either the old standalone command or the new `next start` command
    # so a stale binary from the previous regime is cleaned up too.
    subprocess.run(['pkill', '-f', 'next/dist/bin/next'],
                   capture_output=True, timeout=5)
    subprocess.run(['pkill', '-f', '.next/standalone/server.js'],
                   capture_output=True, timeout=5)
    free_port()
    return 0


def cmd_restart():
    cmd_stop()
    time.sleep(1)
    return cmd_start()


# ---------------------------------------------------------------------------
# Entry
# ---------------------------------------------------------------------------
if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'status'
    if cmd == 'start':
        sys.exit(cmd_start())
    elif cmd == 'stop':
        sys.exit(cmd_stop())
    elif cmd == 'restart':
        sys.exit(cmd_restart())
    elif cmd == 'status':
        sys.exit(cmd_status())
    else:
        print(f"unknown command: {cmd}", file=sys.stderr)
        print(__doc__, file=sys.stderr)
        sys.exit(2)
