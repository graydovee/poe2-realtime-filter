"use client";

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

type CachedItemImageProps = {
  src?: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  onError?: () => void;
};

const ITEM_ICON_CACHE = "poe2-filter-item-icons-v1";
type LoadedItemIcon = Blob | string;
const pendingLoads = new Map<string, Promise<LoadedItemIcon | null>>();

async function loadItemIcon(src: string): Promise<LoadedItemIcon | null> {
  const existing = pendingLoads.get(src);
  if (existing) return existing;

  const request = (async () => {
    try {
      try {
        const localDataUrl = await invoke<string>("item_icon", { url: src });
        if (localDataUrl.startsWith("data:image/")) return localDataUrl;
      } catch {
        // The desktop command is unavailable in the browser development build.
      }

      if (typeof caches === "undefined") return null;

      const cache = await caches.open(ITEM_ICON_CACHE);
      const cached = await cache.match(src);
      if (cached) {
        const cachedBlob = await cached.blob();
        if (cachedBlob.size > 0) return cachedBlob;
      }

      const response = await fetch(src, {
        credentials: "omit",
        mode: "cors",
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) throw new Error(`Icon request failed with ${response.status}`);

      const responseForCache = response.clone();
      const iconBlob = await response.blob();
      if (iconBlob.size === 0) throw new Error("Icon response was empty");

      try {
        await cache.put(src, responseForCache);
      } catch {
        // The image can still be displayed when the browser refuses to persist the cache entry.
      }

      return iconBlob;
    } catch {
      return null;
    } finally {
      pendingLoads.delete(src);
    }
  })();

  pendingLoads.set(src, request);
  return request;
}

export function CachedItemImage({ src, alt, width, height, className, onError }: CachedItemImageProps) {
  const [resolvedSrc, setResolvedSrc] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setResolvedSrc(undefined);

    if (!src) {
      setResolvedSrc(null);
      return () => {
        active = false;
      };
    }

    void loadItemIcon(src).then((icon) => {
      const objectUrl = icon instanceof Blob ? URL.createObjectURL(icon) : icon;
      if (active) setResolvedSrc(objectUrl ?? src);
      else if (objectUrl?.startsWith("blob:")) URL.revokeObjectURL(objectUrl);
    });

    return () => {
      active = false;
    };
  }, [src]);

  const handleError = () => {
    if (resolvedSrc?.startsWith("blob:")) {
      URL.revokeObjectURL(resolvedSrc);
      setResolvedSrc(src ?? null);
      return;
    }
    onError?.();
  };

  useEffect(() => () => {
    if (resolvedSrc?.startsWith("blob:")) URL.revokeObjectURL(resolvedSrc);
  }, [resolvedSrc]);

  if (!resolvedSrc) return <span aria-hidden="true" className={className} />;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={resolvedSrc}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={handleError}
      className={className}
    />
  );
}
