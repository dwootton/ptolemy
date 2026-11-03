import React from 'react';

interface JuliaIconProps extends React.SVGProps<SVGSVGElement> {
  color?: string;
}

export const JuliaIcon: React.FC<JuliaIconProps> = ({ color = "#9F74B3", ...props }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16" {...props}>
    <g fill={color}>
      <circle cx="11.3" cy="20.3" r="3.9"/>
      <circle cx="20.7" cy="20.3" r="3.9"/>
      <circle cx="16" cy="11.7" r="3.9"/>
    </g>
  </svg>
);