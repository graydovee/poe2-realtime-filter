"""从游戏 FMOD bank 里导出内置过滤器音效（PlayAlertSound 1-16）。

用法（需要本地安装 PoE2，Steam 或 WeGame 版均可）：

    python -m pip install fsb5 pyogg
    python scripts/extract-poe2-alert-sounds.py
    python scripts/extract-poe2-alert-sounds.py "D:/.../Path of Exile 2"

产物写入 public/sounds/alert-sound-<N>.ogg，规则编辑器据此试听内置音效。
这些是 Grinding Gear Games 的游戏音频资源，请自行判断是否适合提交到公开仓库。
"""

from __future__ import annotations

import os
import re
import sys

import fsb5
import pyogg
import fsb5.vorbis as vorbis_encoder

DEFAULT_BANKS = [
    r"D:\Program Files (x86)\Steam\steamapps\common\Path of Exile 2\FMOD\Desktop\Four_ItemFilter.bank",
    r"D:\WeGameApps\rail_apps\流放之路：降临(2002052)\FMOD\Desktop\Four_ItemFilter.bank",
]
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "sounds")


def locate_bank(argument: str | None) -> str:
    if argument:
        candidate = argument if argument.lower().endswith(".bank") else os.path.join(argument, "FMOD", "Desktop", "Four_ItemFilter.bank")
        if not os.path.exists(candidate):
            raise SystemExit("找不到 bank 文件：" + candidate)
        return candidate
    for candidate in DEFAULT_BANKS:
        if os.path.exists(candidate):
            return candidate
    raise SystemExit("找不到 Four_ItemFilter.bank，请在命令行传入游戏安装目录")


def main() -> None:
    bank = locate_bank(sys.argv[1] if len(sys.argv) > 1 else None)
    # fsb5 用 cwd 下的 libvorbis.dll / libogg.dll（pyogg 自带）做 Ogg 封装
    os.chdir(os.path.dirname(pyogg.__file__))
    data = open(bank, "rb").read()
    parsed = fsb5.FSB5(data[data.index(b"FSB5"):])
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    written = 0
    for sample in parsed.samples:
        match = re.fullmatch(r"AlertSound_(\d{2})", sample.name or "")
        if not match:
            continue
        number = int(match.group(1))
        if not 1 <= number <= 16:
            continue
        ogg = bytes(vorbis_encoder.rebuild(sample))
        target = os.path.join(OUTPUT_DIR, "alert-sound-%d.ogg" % number)
        with open(target, "wb") as handle:
            handle.write(ogg)
        written += 1
        print("alert-sound-%d.ogg  %.0f KB" % (number, len(ogg) / 1024))
    print("完成：" + str(written) + " 个文件 -> " + OUTPUT_DIR)


if __name__ == "__main__":
    main()
