'use client';

import React from 'react';

interface StepProps {
  title: string;
  children: React.ReactNode;
}

export function Step({ title, children }: StepProps) {
  return (
    <div className="relative pl-10 pb-8 last:pb-0 group">
      {/* Vertical connector line */}
      <div className="absolute left-[15px] top-8 bottom-0 w-px bg-gray-200 group-last:hidden" />
      {/* Step number circle */}
      <div className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white text-sm font-bold shadow-sm">
        <span className="step-number" />
      </div>
      <div className="pt-0.5">
        <h4 className="font-semibold text-gray-900 text-sm mb-1">{title}</h4>
        <div className="text-sm text-gray-600 [&>p]:m-0">{children}</div>
      </div>
    </div>
  );
}

interface StepsProps {
  children: React.ReactNode;
}

export function Steps({ children }: StepsProps) {
  let stepIndex = 0;
  const numberedChildren = React.Children.map(children, (child) => {
    if (React.isValidElement(child) && child.type === Step) {
      stepIndex++;
      const num = stepIndex;
      return (
        <div className="relative pl-10 pb-8 last:pb-0 group">
          <div className="absolute left-[15px] top-8 bottom-0 w-px bg-gray-200 group-last:hidden" />
          <div className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white text-sm font-bold shadow-sm">
            {num}
          </div>
          <div className="pt-0.5">
            <h4 className="font-semibold text-gray-900 text-sm mb-1">{child.props.title}</h4>
            <div className="text-sm text-gray-600 [&>p]:m-0">{child.props.children}</div>
          </div>
        </div>
      );
    }
    return child;
  });

  return (
    <div className="not-prose my-6 rounded-lg border bg-white p-6">
      {numberedChildren}
    </div>
  );
}
