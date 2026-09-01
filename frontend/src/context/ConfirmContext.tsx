import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Modal } from 'antd';

// Awaitable confirmation. Call confirm() and await it: the promise RESOLVES when the user
// confirms and REJECTS when they cancel/dismiss, so a destructive action reads naturally:
//
//   try { await confirm({ title: 'Delete X', danger: true }); await doDelete(); }
//   catch { /* user cancelled */ }
//
// One shared dialog lives in the provider; every caller reuses it. (Simple version of
// https://medium.com/@hrupanjan — form-integrated variant omitted; not needed here.)

export interface ConfirmOptions {
  title?: ReactNode;
  description?: ReactNode;
  confirmationText?: string;
  cancelText?: string;
  danger?: boolean;
}

type ConfirmFn = (options?: ConfirmOptions) => Promise<void>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions>({});
  // resolve/reject of the in-flight promise; a ref so settling doesn't depend on render timing.
  const resolver = useRef<{ resolve: () => void; reject: (reason?: unknown) => void } | null>(null);

  const confirm = useCallback<ConfirmFn>((opts = {}) => {
    setOptions(opts);
    setOpen(true);
    return new Promise<void>((resolve, reject) => {
      resolver.current = { resolve, reject };
    });
  }, []);

  const settle = (ok: boolean) => {
    setOpen(false);
    const r = resolver.current;
    resolver.current = null;
    if (!r) return;
    if (ok) r.resolve();
    else r.reject(new Error('confirmation cancelled'));
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={open}
        title={options.title ?? 'Are you sure?'}
        okText={options.confirmationText ?? 'Confirm'}
        cancelText={options.cancelText ?? 'Cancel'}
        okButtonProps={{ danger: options.danger }}
        onOk={() => settle(true)}
        onCancel={() => settle(false)}
        centered
      >
        {options.description}
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmationProvider');
  return ctx;
}
