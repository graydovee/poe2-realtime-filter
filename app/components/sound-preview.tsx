"use client";

import { useEffect, useRef, useState } from "react";
import { Square, Volume2 } from "lucide-react";

import { readSound } from "../../lib/desktop";
import type { BaseFilter, PresetSound } from "../../lib/types";
import { Button } from "./ui/button";
import { Tooltip } from "./ui/tooltip";

/** 游戏内置音效的本地副本命名：public/sounds/alert-sound-1.mp3（也支持 ogg/wav）。 */
const ALERT_EXTENSIONS = ["mp3", "ogg", "wav"];

async function hasBuiltinFile(id: number) {
  for (const extension of ALERT_EXTENSIONS) {
    try {
      const response = await fetch("/sounds/alert-sound-" + id + "." + extension, { method: "HEAD" });
      if (response.ok) return "/sounds/alert-sound-" + id + "." + extension;
    } catch {
      // 静态文件不存在时继续尝试下一个扩展名。
    }
  }
  return undefined;
}

/** 试听一条规则的音效；再次点击停止。 */
export function SoundPreviewButton({
  sound,
  file,
  base,
  className,
}: {
  sound?: PresetSound;
  file?: File;
  base?: BaseFilter;
  className?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [builtinSource, setBuiltinSource] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (sound?.type !== "builtin") {
      setChecked(false);
      setBuiltinSource(null);
      return;
    }
    let cancelled = false;
    setChecked(false);
    void hasBuiltinFile(sound.id).then((source) => {
      if (cancelled) return;
      setBuiltinSource(source ?? null);
      setChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [sound]);

  function stop() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setPlaying(false);
  }

  useEffect(() => stop, []);

  async function play() {
    if (!sound) return;
    if (playing) {
      stop();
      return;
    }
    let source: string | undefined;
    if (sound.type === "builtin") source = builtinSource ?? undefined;
    else if (sound.type === "custom" && file) {
      const url = URL.createObjectURL(file);
      urlRef.current = url;
      source = url;
    } else if ((sound.type === "neversink" || sound.type === "baseline") && base) {
      try {
        source = URL.createObjectURL(
          await readSound(sound.type === "baseline" ? `@poe2rf-baseline/${sound.fileName.split(";")[0]}` : sound.fileName, undefined, base),
        );
        urlRef.current = source;
      } catch {
        return;
      }
    }
    if (!source) return;
    const audio = new Audio(source);
    audio.volume = sound.type === "builtin" || sound.type === "baseline" ? Math.min(1, (sound.volume ?? 100) / 300) : 1;
    audio.onended = () => setPlaying(false);
    audio.onerror = () => setPlaying(false);
    audioRef.current = audio;
    setPlaying(true);
    try {
      await audio.play();
    } catch {
      setPlaying(false);
    }
  }

  const missingBuiltin = sound?.type === "builtin" && checked && !builtinSource;
  const disabled = !sound || missingBuiltin;
  const hint = !sound
    ? "沿用基础过滤器的音效"
    : sound.type === "builtin"
      ? missingBuiltin
        ? `可在游戏内试听内置音效 ${sound.id}`
        : `内置音效 ${sound.id}`
      : sound.fileName;

  return (
    <div className={className}>
      <Tooltip label={hint}>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void play()}
          disabled={disabled || (sound?.type === "builtin" && !checked)}
          aria-label={playing ? "停止试听" : "试听音效"}
        >
          {playing ? <Square aria-hidden="true" className="size-3" /> : <Volume2 aria-hidden="true" />}
          {playing ? "停止" : "试听"}
        </Button>
      </Tooltip>
    </div>
  );
}
