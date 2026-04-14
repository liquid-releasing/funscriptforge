"""Save clipboard image to a named PNG file in this folder.

Usage: python save_clipboard.py 01-project-loaded
"""
import sys
from pathlib import Path

try:
    from PIL import ImageGrab
except ImportError:
    print("Installing Pillow...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow", "-q"])
    from PIL import ImageGrab

if len(sys.argv) < 2:
    print("Usage: python save_clipboard.py <name>")
    print("Example: python save_clipboard.py 01-project-loaded")
    sys.exit(1)

name = sys.argv[1]
if not name.endswith(".png"):
    name += ".png"

out = Path(__file__).parent / name

img = ImageGrab.grabclipboard()
if img is None:
    print("No image on clipboard. Use Win+Shift+S first.")
    sys.exit(1)

img.save(out, "PNG")
print(f"Saved: {out}")
