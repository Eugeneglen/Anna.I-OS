"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Pencil, Save, X, BookOpen, ChevronDown, ChevronUp } from "lucide-react";

// ============================================================
// Anna.I — Ops Config: Editable README Section
// ============================================================
// Renders a collapsible README card with markdown preview.
// Admin users can click "Edit" to open a dialog with a full
// Textarea for editing the content in Markdown.
// Content is persisted via PlatformConfig (key-value store).
// ============================================================

interface EditableReadmeProps {
  readmeKey: string;
  title: string;
  icon: React.ReactNode;
  content: string;
  isAdmin: boolean;
  isSaving: boolean;
  onSave: (key: string, content: string) => void;
  defaultCollapsed?: boolean;
}

export function EditableReadme({
  readmeKey,
  title,
  icon,
  content,
  isAdmin,
  isSaving,
  onSave,
  defaultCollapsed = false,
}: EditableReadmeProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);

  function openEditor() {
    setDraft(content);
    setEditing(true);
  }

  function handleSave() {
    onSave(readmeKey, draft);
    setEditing(false);
  }

  function handleCancel() {
    setEditing(false);
    setDraft(content);
  }

  return (
    <>
      <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 border-b border-[var(--anna-border)] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]">
              {icon}
            </div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              {title}
            </h3>
          </div>
          <div className="flex items-center gap-1.5">
            {isAdmin && (
              <Button
                onClick={openEditor}
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[var(--anna-slate-light)] hover:text-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage-light)] text-xs"
              >
                <Pencil className="h-3 w-3 mr-1" />
                Edit
              </Button>
            )}
            <Button
              onClick={() => setCollapsed(!collapsed)}
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[var(--anna-muted)] hover:text-[var(--anna-slate)] hover:bg-[var(--anna-sage-light)]"
            >
              {collapsed ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>

        {/* Content */}
        {!collapsed && (
          <div className="px-5 py-4 max-h-80 overflow-y-auto anna-scroll">
            {content ? (
              <div className="prose prose-sm max-w-none text-[var(--anna-slate)] prose-headings:text-[var(--anna-slate)] prose-h1:text-base prose-h2:text-sm prose-h3:text-xs prose-p:text-xs prose-p:leading-relaxed prose-li:text-xs prose-li:leading-relaxed prose-strong:text-[var(--anna-slate)] prose-code:text-[var(--anna-sage-dark)] prose-code:bg-[var(--anna-sage-light)] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[11px] prose-pre:bg-[var(--anna-bg)] prose-table:text-xs">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {content}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <BookOpen className="h-8 w-8 text-[var(--anna-muted)] mb-2" />
                <p className="text-xs text-[var(--anna-muted)]">
                  No content yet. Click <span className="font-semibold">Edit</span> to add documentation.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={editing} onOpenChange={(open) => !open && handleCancel()}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-[var(--anna-slate)] flex items-center gap-2">
              {icon}
              Edit: {title}
            </DialogTitle>
            <DialogDescription className="text-xs text-[var(--anna-muted)]">
              Write in Markdown. Changes are saved to the database and visible to all Ops users.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full min-h-[320px] max-h-[50vh] font-mono text-xs leading-relaxed resize-y rounded-xl border-[var(--anna-border)] bg-[var(--anna-bg)] text-[var(--anna-slate)] focus:ring-[var(--anna-sage)]/30 placeholder:text-[var(--anna-muted)]"
              placeholder="Write your documentation in Markdown here..."
            />
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button
              onClick={handleCancel}
              variant="outline"
              size="sm"
              className="rounded-xl text-xs border-[var(--anna-border)] text-[var(--anna-slate-light)] hover:bg-[var(--anna-sage-light)]"
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
              size="sm"
              className="rounded-xl text-xs bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white font-semibold"
            >
              <Save className="h-3.5 w-3.5 mr-1" />
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
