# 内置音效试听（alert-sound-N）

浏览器无法直接播放游戏内置的 `PlayAlertSound 1–16`：过滤器里只写音效编号，音频本身在游戏客户端里。

这里的 16 个文件是从游戏自己的 FMOD bank 里导出的**真实内置音效**：

```text
游戏安装：D:\Program Files (x86)\Steam\steamapps\common\Path of Exile 2
音效 bank：FMOD\Desktop\Four_ItemFilter.bank
样本名：  AlertSound_01 … AlertSound_16（44.1kHz 立体声 Vorbis，1.5–2.5 秒）
产物：    public/sounds/alert-sound-1.ogg … alert-sound-16.ogg
```

重新生成：

```bash
python -m pip install fsb5 pyogg
python scripts/extract-poe2-alert-sounds.py "D:/Program Files (x86)/Steam/steamapps/common/Path of Exile 2"
```

- 命名必须是 `alert-sound-<编号>`，编号对应过滤器里的 `PlayAlertSound <编号>`；也支持 `.mp3` / `.wav`。
- 文件缺失时「播放音效」按钮会置灰并提示缺少音频，不会播放近似音。
- 模板音效（`CustomAlertSound "xxx.mp3"`）不依赖这里，直接从 `vendor/neversink/(STYLE) CUSTOMSOUNDS` 转发，和游戏内播放的是同一个文件。
- 这些是 Grinding Gear Games 的游戏音频资源，仓库公开时请自行判断是否适合入库；删掉文件即可回到置灰状态。
