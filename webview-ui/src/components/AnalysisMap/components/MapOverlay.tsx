import React from "react";
import { LoadingState } from "./LoadingState";

export interface MapOverlayProps {
  isLoading?: boolean;
  loadingMessage?: string;
}

export const MapOverlay: React.FC<MapOverlayProps> = (props) => {
  return (
    <LoadingState
      isLoading={props.isLoading || false}
      message={props.loadingMessage}
    />
  );
}; 