"""Shared UI helpers for forge tabs."""

import streamlit as st


def success_guidance(message: str):
    """Show a green success box with guidance on what to do next."""
    st.success(message)
