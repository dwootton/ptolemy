import React from 'react';

interface CssIconProps extends React.SVGProps<SVGSVGElement> {
  color?: string;
}

export const CssIcon: React.FC<CssIconProps> = ({ color = "#529BBA", ...props }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16" {...props}>
    <path fill={color} d="M10.3 23.3l.8-4H8.6v-2.1h3l.5-2.5H9.5v-2.1h3.1l.8-3.9h2.8l-.8 3.9h2.8l.8-3.9h2.8l-.8 3.9h2.5v2.1h-2.9l-.6 2.5h2.6v2.1h-3l-.8 4H16l.8-4H14l-.8 4h-2.9zm6.9-6.1l.5-2.5h-2.8l-.5 2.5h2.8z"/>
  </svg>
);