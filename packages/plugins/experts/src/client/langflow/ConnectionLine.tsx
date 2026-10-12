// Adapted from Langflow v1.12.5 ConnectionLineComponent; MIT, copyright (c) 2024 Langflow.
// WorkDSH supplies color directly rather than importing the Langflow runtime store.
import * as React from 'react';
import type { ConnectionLineComponentProps } from '@xyflow/react';
export function ConnectionLine({fromX,fromY,toX,toY,connectionLineStyle={}}:ConnectionLineComponentProps) {
  return <g><path fill="none" strokeWidth={2} style={{stroke:'#7057ea',...connectionLineStyle}} d={`M${fromX},${fromY} C ${fromX} ${toY} ${fromX} ${toY} ${toX},${toY}`}/><circle cx={toX} cy={toY} fill="#fff" r={5} stroke="#7057ea" strokeWidth={1.5}/></g>;
}
