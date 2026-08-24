#!/usr/bin/env python3
"""
图片圆角透明化处理脚本
用于将 PC 端截图四周的非透明边角/直角转换为平滑的高质量透明圆角 (RGBA PNG)。
支持命令行指定文件或默认批量处理 images/pc-dsh-setting-*.png
"""

import sys
import glob
import os
from PIL import Image, ImageDraw, ImageChops

def apply_rounded_corners(image_path: str, output_path: str = None, radius: int = 36):
    """
    为指定图片添加平滑抗锯齿的透明圆角
    :param image_path: 输入图片路径
    :param output_path: 输出图片路径（默认覆盖原图）
    :param radius: 圆角半径（像素）
    """
    if output_path is None:
        output_path = image_path

    # 打开图片并转换为 RGBA
    img = Image.open(image_path).convert("RGBA")
    w, h = img.size

    # 使用 4 倍超采样生成抗锯齿圆角遮罩
    scale = 4
    mask = Image.new("L", (w * scale, h * scale), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        [(0, 0), (w * scale, h * scale)],
        radius=radius * scale,
        fill=255
    )
    mask = mask.resize((w, h), Image.Resampling.LANCZOS)

    # 合并原图现有 alpha 通道与圆角遮罩
    orig_alpha = img.split()[-1]
    final_alpha = ImageChops.multiply(orig_alpha, mask)

    img.putalpha(final_alpha)
    img.save(output_path, "PNG", optimize=True)
    print(f"✅ 处理完成: {image_path} -> {output_path} (圆角半径: {radius}px, 尺寸: {w}x{h})")

def main():
    radius = 36
    # 解析命令行参数
    files = []
    if len(sys.argv) > 1:
        for arg in sys.argv[1:]:
            if arg.startswith("--radius="):
                radius = int(arg.split("=")[1])
            elif os.path.exists(arg):
                files.append(arg)
            else:
                matched = glob.glob(arg)
                if matched:
                    files.extend(matched)
    
    # 默认处理 images/pc-dsh-setting-*.png
    if not files:
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        pattern = os.path.join(base_dir, "images", "pc-dsh-setting-*.png")
        files = sorted(glob.glob(pattern))

    if not files:
        print("未找到需要处理的图片文件。")
        return

    print(f"开始处理 {len(files)} 张图片，圆角半径: {radius}px...")
    for file_path in files:
        apply_rounded_corners(file_path, radius=radius)

if __name__ == "__main__":
    main()
