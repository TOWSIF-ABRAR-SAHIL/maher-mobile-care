export {};

/** One folder choice from the native dialog; a cancel carries no path. */
export type DesktopDirectorySelection =
  | { canceled?: boolean; path?: string | null }
  | string
  | null;

declare global {
  interface Window {
    maherDesktop?: {
      isElectron: boolean;
      printReceipt(options?: { deviceName?: string }): Promise<void>;
      getPrinters(): Promise<Array<{ name: string; displayName?: string }>>;
      selectDirectory?(): Promise<DesktopDirectorySelection>;
      /** Keep the native window title in sync with the tenant shop profile. */
      setWindowTitle?(shopName: string): Promise<void> | void;
    };
    /** Compatibility alias used by generic Electron bridges when present. */
    electronAPI?: {
      selectDirectory?(): Promise<DesktopDirectorySelection>;
    };
  }
}
