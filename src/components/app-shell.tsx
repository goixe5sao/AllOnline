"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { api, useMe, type Me } from "@/lib/api";
import { Badge, Button, Card, CardBody, Skeleton } from "./ui";
import { ThemeToggle } from "./theme-toggle";

export function AppShell({ children, narrow, requireLogin }: { children: (me: Me) => ReactNode; narrow?: boolean; requireLogin?: boolean }) {
  const { loading, user, mode } = useMe();
  const path = usePathname();
  const link = (href: string, label: string) => (
    <Link href={href} aria-current={path === href ? "page" : undefined} className={path === href ? "active" : undefined}>
      {label}
    </Link>
  );

  return (
    <div className="ui-shell">
      {mode === "demo" && (
        <div className="demo-ribbon" role="note">
          <strong>CHẾ ĐỘ DEMO</strong> — dữ liệu lưu cục bộ (PGlite), đăng nhập demo và thanh toán giả. Không phải kết nối Supabase/thanh toán thật.
        </div>
      )}
      <header className="topnav">
        <Link href="/" className="brand">
          <span className="brand-mark">S</span> Sân Khấu Online
        </Link>
        <nav aria-label="Điều hướng chính">
          {link("/", "Tổng quan")}
          {user && !user.isGuest && link("/rooms/new", "Tạo phòng")}
          {user && !user.isGuest && link("/orders", "Đơn của tôi")}
          {user && !user.isGuest && link("/account", "Tài khoản")}
          {user?.role === "app_owner" && link("/admin", "Quản trị")}
        </nav>
        <span className="spacer" />
        <ThemeToggle />
        {user ? (
          <span className="ui-shell-user">
            <span className="ui-shell-user">
              {user.displayName}
              {user.isDemo && <Badge tone="warning">demo</Badge>}
              {user.isGuest && <Badge>khách</Badge>}
              {user.role === "app_owner" && <Badge tone="success">chủ ứng dụng</Badge>}
            </span>
            <Button
              size="sm"
              onClick={async () => {
                await api("/api/auth/logout", { body: {} });
                window.location.assign("/");
              }}
            >
              Đăng xuất
            </Button>
          </span>
        ) : (
          !loading && (
            <Link className="ui-button ui-button-primary ui-button-sm" href={`/login?next=${encodeURIComponent(path)}`}>
              Đăng nhập
            </Link>
          )
        )}
      </header>
      <main className={`page ${narrow ? "page-narrow" : ""}`}>
        {loading ? (
          <Skeleton aria-label="Đang tải tài khoản" />
        ) : requireLogin && (!user || user.isGuest) ? (
          <Card><CardBody>
            <p>{user?.isGuest ? "Chức năng này cần tài khoản. Khách chỉ có thể tham dự phòng qua link mời." : "Bạn cần đăng nhập để tiếp tục."}</p>
            <Link className="ui-button ui-button-primary" href={`/login?next=${encodeURIComponent(path)}`}>
              Đăng nhập
            </Link>
          </CardBody></Card>
        ) : (
          children(user as Me)
        )}
      </main>
    </div>
  );
}
