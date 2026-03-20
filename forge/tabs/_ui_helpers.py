"""Shared UI helpers for forge tabs."""

import streamlit as st


def scroll_to_top(delay_ms: int = 1500):
    """Smooth scroll to top of the tab content after a delay.
    Call after rendering the success message so the user sees it first."""
    import streamlit.components.v1 as components
    components.html(
        f"""<script>
        setTimeout(function() {{
            var container = window.parent.document.querySelector(
                '[data-testid="stAppViewContainer"]'
            );
            if (container) {{
                container.scrollTo({{top: 0, behavior: 'smooth'}});
            }}
        }}, {delay_ms});
        </script>""",
        height=0,
    )


def success_with_scroll(message: str):
    """Show a success message. Clicking it scrolls to top of the tab."""
    import streamlit.components.v1 as components
    st.success(message)
    # Add a small clickable "↑ scroll to top" link below
    components.html(
        """<div style="text-align:center;margin-top:-10px;margin-bottom:8px;">
        <a href="#" onclick="
            var c = window.parent.document.querySelector('[data-testid=&quot;stAppViewContainer&quot;]');
            if (c) c.scrollTo({top:0, behavior:'smooth'});
            return false;
        " style="color:#888;font-size:0.75em;text-decoration:none;">
        ↑ scroll to top</a></div>""",
        height=30,
    )
