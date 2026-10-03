import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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

function SettingsSwitch({ label, checked, disabled, onChange }: {
  label: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void;
}) {
  return <label className="settings-switch-row" data-disabled={disabled}>
    <span className="settings-switch-label">{label}</span>
    <span className="settings-switch-control">
      <input type="checkbox" role="switch" className="settings-switch-input" checked={checked} disabled={disabled}
        onChange={event => onChange(event.currentTarget.checked)}
        onKeyDown={event => {
          if (event.key === "Enter") { event.preventDefault(); event.currentTarget.click(); }
        }} />
      <span className="settings-switch-track" aria-hidden="true" />
    </span>
  </label>;
}

export function SettingsControls({ preferences, dark, reduced, saving, error, onSave }: ControlsProps) {
  const disabled = !preferences || saving;
  return <>
    <div className="settings-controls" aria-busy={saving}>
      <SettingsSwitch label="Dark Mode" checked={dark} disabled={disabled}
        onChange={checked => onSave({ theme: checked ? "dark" : "light" })} />
      <SettingsSwitch label="Reduced Motion" checked={reduced} disabled={disabled}
        onChange={checked => onSave({ motion: checked ? "reduced" : "full" })} />
      <SettingsSwitch label="Auto Start" checked={preferences?.autoOpen ?? false} disabled={disabled}
        onChange={checked => onSave({ autoOpen: checked })} />
      <SettingsSwitch label="Chat Bubbles" checked={preferences?.chatBubbles ?? true} disabled={disabled}
        onChange={checked => onSave({ chatBubbles: checked })} />
    </div>
    <p>Auto Start applies to new sessions; this panel stays open.</p>
    <p role="status" className="settings-save-status">{saving ? "Saving preference..." : ""}</p>
    {!preferences && !error && <p role="status">Loading saved settings...</p>}
    {error && <p role="alert">{error}</p>}
  </>;
}

export function settingsPosition(anchor: { right: number; bottom: number }, panel: { width: number; height: number },
  viewport: { width: number; height: number }) {
  return {
    left: Math.max(8, Math.min(viewport.width - panel.width - 8, anchor.right - panel.width)),
    top: Math.max(8, Math.min(viewport.height - panel.height - 8, anchor.bottom + 8)),
  };
}

export function SettingsPopover({ children, ...props }: {
  children: ReactNode; reduced: boolean; dark: boolean;
}) {
  return <div className="settings-popover-content" data-reduced-motion={props.reduced} data-office-theme={props.dark ? "dark" : "light"}>
    {children}
  </div>;
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
      const width = panel.current?.offsetWidth ?? 280;
      const height = panel.current?.offsetHeight ?? 250;
      setPosition(settingsPosition(rect, { width, height }, { width: window.innerWidth, height: window.innerHeight }));
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
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <polygon points="9,2 15,2 16,5 19,5 22,10 20,12 22,14 19,19 16,19 15,22 9,22 8,19 5,19 2,14 4,12 2,10 5,5 8,5" />
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
      <SettingsPopover reduced={props.reduced} dark={props.dark}><SettingsControls {...props} /></SettingsPopover>
    </div>, document.body)}
  </>;
}
