"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { trackDashboardInterventionClick } from "@/lib/product-analytics";

type LinkProps = ComponentProps<typeof Link>;

/** 管理驾驶舱等场景：带一次自定义事件上报的导航链接 */
export function TrackedLink({
  trackTarget,
  onClick,
  ...props
}: LinkProps & { trackTarget: string }) {
  return (
    <Link
      {...props}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) trackDashboardInterventionClick(trackTarget);
      }}
    />
  );
}
