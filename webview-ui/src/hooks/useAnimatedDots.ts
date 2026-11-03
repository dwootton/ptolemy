import { useEffect, useState } from 'react';

export function useAnimatedDots(intervalMs: number = 400, maxDots: number = 3): string {
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    const id = setInterval(() => {
      setCount(prev => (prev + 1) % (maxDots + 1));
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, maxDots]);

  return '.'.repeat(count);
}

