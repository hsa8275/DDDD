// src/components/VoicePicker.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ElevenVoice } from "../lib/eleven";

type MenuPos = { top: number; left: number; width: number; dir: "down" | "up" };

export function VoicePicker(props: {
  voices: ElevenVoice[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const { voices, value, onChange, placeholder } = props;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [pos, setPos] = useState<MenuPos>({ top: 0, left: 0, width: 320, dir: "down" });

  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(() => voices.find((v) => v.voice_id === value), [voices, value]);

  const labelMain = selected?.name ?? placeholder ?? "Select";
  const labelSub = selected?.category ? `category: ${selected.category}` : "type: voice";

  function estimateMenuHeight() {
    const header = 44;
    const itemH = 44;
    const listMax = 260;
    const listH = Math.min(voices.length * itemH, listMax);
    return header + listH;
  }

  function updatePos() {
    const el = triggerRef.current;
    if (!el) return;

    const r = el.getBoundingClientRect();
    const pad = 8;

    const menuH = estimateMenuHeight();
    const downTop = r.bottom + pad;
    const upTop = r.top - pad - menuH;

    const canDown = downTop + menuH <= window.innerHeight - 8;
    const canUp = upTop >= 8;

    const dir: "down" | "up" = !canDown && canUp ? "up" : "down";
    const top = dir === "down" ? downTop : upTop;

    const width = r.width;
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    const left = Math.min(Math.max(8, r.left), maxLeft);

    setPos({ top, left, width, dir });
  }

  function toggle() {
    setOpen((v) => !v);
  }

  function pick(id: string) {
    onChange(id);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;

    updatePos();

    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      const root = rootRef.current;
      const menu = menuRef.current;

      const inRoot = root ? root.contains(t) : false;
      const inMenu = menu ? menu.contains(t) : false;

      if (!inRoot && !inMenu) setOpen(false);
    };

    const onScroll = () => updatePos();
    const onResize = () => updatePos();

    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);

    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, voices.length]);

  useEffect(() => {
    if (!open) return;
    const idx = voices.findIndex((v) => v.voice_id === value);
    setActiveIndex(idx >= 0 ? idx : 0);
  }, [open, voices, value]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;

    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, voices.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const v = voices[activeIndex];
      if (v) pick(v.voice_id);
    }
  }

  const menu = open ? (
    <div
      ref={menuRef}
      className="ts-menu"
      role="listbox"
      tabIndex={-1}
      aria-label="voice list"
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: pos.width,
        zIndex: 2147483647,
      }}
    >
      <div className="ts-menuHeader">
        <div className="ts-menuTitle">Voice 목록</div>
        <div className="ts-menuTitle">{voices.length}개</div>
      </div>

      <div className="ts-menuList">
        {voices.length === 0 ? (
          <div className="px-3 py-3" style={{ color: "var(--muted)", fontSize: 12 }}>
            voices loading...
          </div>
        ) : (
          voices.map((v, idx) => {
            const isSelected = v.voice_id === value;
            const isActive = idx === activeIndex;

            return (
              <button
                key={v.voice_id}
                type="button"
                className={`ts-menuItem ${isSelected ? "ts-menuItemActive" : ""}`}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => pick(v.voice_id)}
                role="option"
                aria-selected={isSelected}
                style={isActive ? { background: "rgba(255,255,255,.06)" } : undefined}
              >
                <div className="ts-menuItemName">
                  <div className="ts-menuItemMain">{v.name}</div>
                  <div className="ts-menuItemMeta">{v.category ? `category: ${v.category}` : "category: -"}</div>
                </div>

                {isSelected ? (
                  <svg className="ts-check" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M20 6L9 17l-5-5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  ) : null;

  return (
    <div ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="ts-input ts-selectTrigger"
        onClick={toggle}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <div className="ts-selectLabel">
          <div className="ts-selectTitle">{labelMain}</div>
          <div className="ts-selectSub">{labelSub}</div>
        </div>

        <svg className={`ts-chevron ${open ? "ts-chevronOpen" : ""}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? createPortal(menu, document.body) : null}
    </div>
  );
}
