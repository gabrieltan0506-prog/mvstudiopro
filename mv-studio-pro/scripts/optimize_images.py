"""
Image optimization script for MV Studio Pro
- Converts cover images from PNG to WebP (80% smaller)
- Compresses app icons and other PNGs
"""
import os
from PIL import Image

PROJECT_ROOT = "/home/ubuntu/mv-studio-pro"

def compress_png(input_path, max_width=None, quality=85):
    """Compress a PNG file in place."""
    img = Image.open(input_path)
    original_size = os.path.getsize(input_path)
    
    if max_width and img.width > max_width:
        ratio = max_width / img.width
        new_height = int(img.height * ratio)
        img = img.resize((max_width, new_height), Image.LANCZOS)
    
    # Save optimized PNG
    img.save(input_path, "PNG", optimize=True)
    new_size = os.path.getsize(input_path)
    saved = original_size - new_size
    print(f"  PNG: {input_path} | {original_size//1024}KB → {new_size//1024}KB (saved {saved//1024}KB)")
    return saved

def convert_to_webp(input_path, output_path, max_width=None, quality=75):
    """Convert PNG to WebP format."""
    img = Image.open(input_path)
    original_size = os.path.getsize(input_path)
    
    if max_width and img.width > max_width:
        ratio = max_width / img.width
        new_height = int(img.height * ratio)
        img = img.resize((max_width, new_height), Image.LANCZOS)
    
    # Convert RGBA to RGB if needed for better compression
    if img.mode == 'RGBA':
        # Keep alpha for transparency
        img.save(output_path, "WEBP", quality=quality, method=6)
    else:
        img.save(output_path, "WEBP", quality=quality, method=6)
    
    new_size = os.path.getsize(output_path)
    saved = original_size - new_size
    print(f"  WebP: {os.path.basename(input_path)} | {original_size//1024}KB → {new_size//1024}KB (saved {saved//1024}KB)")
    return saved

def main():
    total_saved = 0
    
    # 1. Compress cover images (PNG → WebP)
    covers_dir = os.path.join(PROJECT_ROOT, "assets/covers")
    if os.path.exists(covers_dir):
        print("=== Optimizing cover images (PNG → WebP) ===")
        for filename in sorted(os.listdir(covers_dir)):
            if filename.endswith(".png"):
                input_path = os.path.join(covers_dir, filename)
                webp_path = input_path.replace(".png", ".webp")
                saved = convert_to_webp(input_path, webp_path, max_width=540, quality=75)
                total_saved += saved
                # Remove original PNG
                os.remove(input_path)
    
    # 2. Compress app icons
    print("\n=== Optimizing app icons ===")
    icon_files = [
        ("assets/images/icon.png", 512),
        ("assets/images/splash-icon.png", 256),
        ("assets/images/android-icon-foreground.png", 256),
        ("assets/images/favicon.png", 64),
    ]
    for rel_path, max_w in icon_files:
        full_path = os.path.join(PROJECT_ROOT, rel_path)
        if os.path.exists(full_path):
            saved = compress_png(full_path, max_width=max_w)
            total_saved += saved
    
    print(f"\n=== Total saved: {total_saved // 1024}KB ({total_saved / (1024*1024):.1f}MB) ===")

if __name__ == "__main__":
    main()
