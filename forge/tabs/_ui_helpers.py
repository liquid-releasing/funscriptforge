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
