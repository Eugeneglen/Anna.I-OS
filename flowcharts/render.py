import asyncio
from playwright.async_api import async_playwright
import os

OUTPUT_DIR = "/home/z/my-project/flowcharts"
HTML_FILES = [
    ("01-booking-lifecycle.html", "01-booking-lifecycle.png"),
    ("02-dispute-cancel.html", "02-dispute-cancel.png"),
    ("03-vendor-assignment.html", "03-vendor-assignment.png"),
]

async def render_to_png(html_name, png_name):
    html_path = os.path.join(OUTPUT_DIR, html_name)
    png_path = os.path.join(OUTPUT_DIR, png_name)
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(
            viewport={"width": 1000, "height": 800},
            device_scale_factor=2
        )
        await page.goto(f"file://{html_path}", wait_until="networkidle")
        await page.wait_for_timeout(500)
        
        # Get root element bounding box
        root = page.locator("#root")
        bbox = await root.bounding_box()
        
        if bbox:
            fit_w = max(1000, int(bbox["width"] + 120))
            fit_h = int(bbox["height"] + 120)
            await page.set_viewport_size({"width": fit_w, "height": fit_h})
            await page.wait_for_timeout(300)
        
        await root.screenshot(path=png_path)
        await browser.close()
        
        size_kb = os.path.getsize(png_path) / 1024
        print(f"✅ {png_name} ({size_kb:.0f} KB)")

async def main():
    for html, png in HTML_FILES:
        await render_to_png(html, png)
    print("\nAll flowcharts rendered successfully!")

asyncio.run(main())
