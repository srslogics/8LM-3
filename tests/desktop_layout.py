"""Desktop layout assertions shared by the interactive workflow checks."""

from pathlib import Path


def check_desktop_layout(page, name):
    output = Path("/tmp/8lm-desktop-audit")
    output.mkdir(exist_ok=True)
    for width in (1280, 1440, 1920):
        page.set_viewport_size({"width": width, "height": 900})
        page.evaluate("window.scrollTo(0, 0)")
        page.evaluate(
            "() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"
        )
        page.screenshot(path=str(output / f"{name}-{width}.png"), full_page=True)
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), name
        # Inputs must fit their form column even when the page itself hides overflow.
        clipped = page.locator("input, select, textarea").evaluate_all("""
            elements => elements.filter(el => el.getClientRects().length && !el.disabled)
              .filter(el => {
                const r = el.getBoundingClientRect();
                const p = el.parentElement.getBoundingClientRect();
                return r.width > p.width + 2;
              }).map(el => el.id)
        """)
        assert not clipped, (name, width, clipped)
        outside = page.locator(".wizard-card, .me-card, .gcp-modal").evaluate_all("""
            elements => elements.filter(el => el.getClientRects().length)
              .filter(el => {
                const r = el.getBoundingClientRect();
                return r.left < -1 || r.right > innerWidth + 1;
              }).map(el => el.className)
        """)
        assert not outside, (name, width, outside)
        pane = page.locator(".me-columns:visible")
        if pane.count():
            original_scroll = pane.evaluate("el => el.scrollTop")
            pane.evaluate("el => el.scrollTop = el.scrollHeight")
            page.screenshot(path=str(output / f"{name}-{width}-bottom.png"))
            pane.evaluate("(el, top) => el.scrollTop = top", original_scroll)
        # Paired Meta fields must retain a shared control baseline when labels wrap.
        for grid in page.locator(".me-editor .meta-field-grid:visible").all():
            controls = grid.locator("input, select").all()
            if len(controls) == 2:
                rects = [control.bounding_box() for control in controls]
                assert (
                    abs(rects[0]["y"] + rects[0]["height"] - rects[1]["y"] - rects[1]["height"]) < 2
                ), (name, width, rects)
    page.set_viewport_size({"width": 1440, "height": 1000})
