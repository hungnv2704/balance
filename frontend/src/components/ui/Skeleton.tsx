'use client';

import React from 'react';

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`rounded-md bg-[#E2E8F0]/75 animate-pulse motion-reduce:animate-none ${className}`}
    />
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Đang tải dữ liệu tổng quan">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-[#E2E8F0] bg-white p-5 space-y-3"
          >
            <SkeletonBlock className="h-4 w-28" />
            <SkeletonBlock className="h-8 w-44" />
            <SkeletonBlock className="h-3 w-36" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-5 space-y-4">
          <SkeletonBlock className="h-5 w-40" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="flex justify-between">
                <SkeletonBlock className="h-4 w-32" />
                <SkeletonBlock className="h-4 w-24" />
              </div>
              <SkeletonBlock className="h-2.5 w-full" />
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-[#E2E8F0] bg-white p-5 space-y-3">
          <SkeletonBlock className="h-5 w-44" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-[#F1F5F9]">
              <div className="space-y-1.5">
                <SkeletonBlock className="h-4 w-48" />
                <SkeletonBlock className="h-3 w-28" />
              </div>
              <SkeletonBlock className="h-5 w-28" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div
      className="rounded-xl border border-[#E2E8F0] bg-white overflow-hidden"
      role="status"
      aria-label="Đang tải danh sách"
    >
      <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 flex justify-between">
        <SkeletonBlock className="h-4 w-36" />
        <SkeletonBlock className="h-4 w-24" />
      </div>
      <div className="divide-y divide-[#E2E8F0]">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div className="space-y-2 flex-1">
              <SkeletonBlock className="h-4 w-56 max-w-full" />
              <SkeletonBlock className="h-3 w-36" />
            </div>
            <SkeletonBlock className="h-6 w-20" />
            <SkeletonBlock className="h-5 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}
