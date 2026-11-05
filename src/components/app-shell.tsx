"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { api, useMe, type Me } from "@/lib/api";
import { ThemeToggle } from "./theme-toggle";

export function AppShell({ children, narrow, requireLogin }: { children: (me: Me) => ReactNode; narrow?: boolean; requireLogin?: boolean }) {
  const { loading, user, mode } = useMe();
  const path = usePathname();
  const link = (href: string, label: string) => (
    <Link href={href} className={path === href ? "active" : undefined}>
      {label}
    </Link>
  );

  return (
    <>
      {mode === "demo" && (
        <div className="demo-ribbon" role="note">
          <strong>CHẾ ĐỘ DEMO</strong> — dữ liệu lưu cục bộ (PGlite), đăng nhập demo và thanh toán giả. Không phải kết nối Supabase/thanh toán thật.
        </div>
      )}
      <header className="topnav">
        <Link href="/" className="brand">
          <span className="brand-mark">A</span> AllOnline
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
          <span className="row">
            <span className="muted">
              {user.displayName}
              {user.isDemo && <span className="badge demo" style={{ marginLeft: 6 }}>demo</span>}
              {user.isGuest && <span className="badge" style={{ marginLeft: 6 }}>khách</span>}
              {user.role === "app_owner" && <span className="badge ok" style={{ marginLeft: 6 }}>chủ ứng dụng</span>}
            </span>
            <button
              className="btn small"
              onClick={async () => {
                await api("/api/auth/logout", { body: {} });
                window.location.assign("/");
              }}
            >
              Đăng xuất
            </button>
          </span>
        ) : (
          !loading && (
            <Link className="btn small primary" href={`/login?next=${encodeURIComponent(path)}`}>
              Đăng nhập
            </Link>
          )
        )}
      </header>
      <main className={`page ${narrow ? "page-narrow" : ""}`}>
        {loading ? (
          <p className="muted">Đang tải…</p>
        ) : requireLogin && (!user || user.isGuest) ? (
          <div className="card">
            <p>{user?.isGuest ? "Chức năng này cần tài khoản. Khách chỉ có thể tham dự phòng qua link mời." : "Bạn cần đăng nhập để tiếp tục."}</p>
            <Link className="btn primary" href={`/login?next=${encodeURIComponent(path)}`}>
              Đăng nhập
            </Link>
          </div>
        ) : (
          children(user as Me)
        )}
      </main>
    </>
  );
}
