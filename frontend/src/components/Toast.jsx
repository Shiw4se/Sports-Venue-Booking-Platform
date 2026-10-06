import React, { createContext, useCallback, useContext, useState } from 'react';

const ToastContext = createContext(() => {});

let nextId = 1;
const TOAST_TTL_MS = 3500;

// Notifications instead of alert(): toast('Text', 'success' | 'error' | 'info')
export const ToastProvider = ({ children }) => {
    const [toasts, setToasts] = useState([]);

    const toast = useCallback((message, type = 'info') => {
        const id = nextId++;
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), TOAST_TTL_MS);
    }, []);

    return (
        <ToastContext.Provider value={toast}>
            {children}
            <div className="toast-stack" role="status" aria-live="polite">
                {toasts.map(t => (
                    <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>
                ))}
            </div>
        </ToastContext.Provider>
    );
};

export const useToast = () => useContext(ToastContext);
