import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PreferenceUpdate, ViewerPreferences } from "./motion-preference";

type ControlsProps = {
  preferences: ViewerPreferences | null;
  dark: boolean;
  reduced: boolean;
  saving: boolean;
  error: string;
  onSave: (update: PreferenceUpdate) => void;
};

export function SettingsControls({ preferences, dark, reduced, saving, error, onSave }: ControlsProps) {
  const disabled = !preferences || saving;
  return <>
    <label><span>Dark Mode</span>
      <input type="checkbox" checked={dark} disabled={disabled}
        onChange={event => onSave({ theme: event.currentTarget.checked ? "dark" : "light" })} /></label>
    <label><span>Reduced Motion</span>
      <input type="checkbox" checked={reduced} disabled={disabled}
        onChange={event => onSave({ motion: event.currentTarget.checked ? "reduced" : "full" })} /></label>
    <label><span>Auto Start</span>
      <input type="checkbox" checked={preferences?.autoOpen ?? false} disabled={disabled}
        onChange={event => onSave({ autoOpen: event.currentTarget.checked })} /></label>
    <label><span>Chat Bubbles</span>
      <input type="checkbox" checked={preferences?.chatBubbles ?? true} disabled={disabled}
        onChange={event => onSave({ chatBubbles: event.currentTarget.checked })} /></label>
    <p>Auto Start applies to new sessions; this panel stays open.</p>
    {saving && <p role="status">Saving preference...</p>}
    {!preferences && !error && <p role="status">Loading saved settings...</p>}
    {error && <p role="alert">{error}</p>}
  </>;
}

export function SettingsMenu(props: ControlsProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const lastControl = useRef<HTMLInputElement | null>(null);
  const [position, setPosition] = useState({ left: 8, top: 48 });
  const loaded = !!props.preferences;
  useEffect(() => {
    if (props.open && !props.saving && document.activeElement === document.body) lastControl.current?.focus();
  }, [props.open, props.saving]);
  useLayoutEffect(() => {
    if (!props.open) return;
    const positionPanel = () => {
      const rect = button.current?.getBoundingClientRect();
      if (!rect) return;
      const width = panel.current?.offsetWidth ?? 260;
      const height = panel.current?.offsetHeight ?? 250;
      setPosition({
        left: Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width)),
        top: Math.max(8, Math.min(window.innerHeight - height - 8, rect.bottom + 8)),
      });
    };
    positionPanel();
    window.addEventListener("resize", positionPanel);
    return () => window.removeEventListener("resize", positionPanel);
  }, [props.open, props.error, props.saving, loaded]);
  useEffect(() => {
    if (!props.open) return;
    (panel.current?.querySelector<HTMLInputElement>("input:not(:disabled)") ?? panel.current)?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !button.current?.contains(event.target)) {
        props.onOpenChange(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      props.onOpenChange(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [props.open, loaded, props.onOpenChange]);
  return <>
    <button type="button" ref={button} className="theme-toggle settings-toggle" aria-label="Office settings"
      title="Office settings" aria-haspopup="dialog" aria-expanded={props.open} aria-controls="office-settings"
      onClick={() => props.onOpenChange(!props.open)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <path d="m9 3-.5 2-2 1.2-2-.5-3 5 1.5 1.3v2l-1.5 1.3 3 5 2-.5 2 1.2.5 2h6l.5-2 2-1.2 2 .5 3-5L21 14v-2l1.5-1.3-3-5-2 .5-2-1.2L15 3Z"
          transform="translate(1.2 .3) scale(.9)" />
        <circle cx="12" cy="12" r="3.3" />
      </svg>
    </button>
    {props.open && createPortal(<div ref={panel} id="office-settings" role="dialog" aria-label="Office settings"
      className="office-settings-popover" tabIndex={-1} style={position}
      onFocusCapture={event => { if (event.target instanceof HTMLInputElement) lastControl.current = event.target; }}
      onBlur={event => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) &&
          !button.current?.contains(event.relatedTarget)) props.onOpenChange(false);
      }}>
      <SettingsControls {...props} />
    </div>, document.body)}
  </>;
}
