
import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

interface MainContentProps {
  children: React.ReactNode;
  compact?: boolean;
}

export const MainContent: React.FC<MainContentProps> = ({ children, compact = false }) => {
  const pathname = useLocation().pathname;
  const [isVisible, setIsVisible] = useState(true);
  const prevPathname = useRef(pathname);

  useEffect(() => {
    if (pathname !== prevPathname.current) {
      setIsVisible(false);
      const timer = setTimeout(() => {
        prevPathname.current = pathname;
        setIsVisible(true);
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [pathname]);

  return (
    <main
      className={`flex-1 flex flex-col min-h-0 bg-bg ${compact ? '' : 'p-3 sm:p-4 md:p-6'} overflow-hidden transition-opacity duration-150 ease-out ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {children}
    </main>
  );
};
