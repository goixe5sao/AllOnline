"use client";

import Link from "next/link";
import { useState } from "react";
import { api, useMe } from "@/lib/api";
import { ThemeToggle } from "@/components/theme-toggle";

/** Header of the home page: section links + account actions (server-rendered as "signed out"). */
export function HomeNav() {
  const { user, loading } = useMe();
  const [open, setOpen] = useState(false);
  const member = user && !user.isGuest;
  return (
    <header className="hn">
      <Link href="/" className="hn-brand" aria-label="AllOnline — trang chủ">
        <span className="hn-mark" aria-hidden>
          A
        </span>
        <span>
          All<b>Online</b>
        </span>
      </Link>
      <ThemeToggle className="hn-theme" />
      <button className="hn-burger" aria-expanded={open} aria-controls="hn-menu" onClick={() => setOpen(!open)}>
        <span className="sr-only">Mở menu</span>
        <span aria-hidden>☰</span>
      </button>
      <nav id="hn-menu" className={`hn-menu ${open ? "open" : ""}`} aria-label="Điều hướng chính" onClick={() => setOpen(false)}>
        <a href="#phong-dang-mo">Phòng đang mở</a>
        <a href="#kieu-san-khau">Kiểu sân khấu</a>
        <a href="#quay-ve">Quầy vé</a>
        <a href="#tiep-tan">Tiếp tân</a>
        <a href="#hoi-dap">Hỏi đáp</a>
        <span className="hn-spacer" />
        {member ? (
          <>
            {user.role === "app_owner" && <Link href="/admin">Quản trị</Link>}
            <Link href="/orders">Đơn của tôi</Link>
            <Link className="hn-cta" href="/rooms/new">
              + Tạo phòng
            </Link>
            <button
              className="hn-ghost"
              onClick={async () => {
                await api("/api/auth/logout", { body: {} });
                window.location.assign("/");
              }}
              title={user.displayName}
            >
              Đăng xuất
            </button>
          </>
        ) : (
          !loading && (
            <>
              <Link href="/login?next=%2F">Đăng nhập</Link>
              <Link className="hn-cta" href="/login?mode=signup&next=%2Frooms%2Fnew">
                Tạo tài khoản
              </Link>
            </>
          )
        )}
      </nav>
    </header>
  );
}

/** Hero call-to-action: depends on whether the visitor already has an account. */
export function HeroActions() {
  const { user } = useMe();
  const member = user && !user.isGuest;
  return (
    <div className="hero-actions">
      <Link className="btn-neon" href={member ? "/rooms/new" : "/login?mode=signup&next=%2Frooms%2Fnew"}>
        {member ? "Mở sân khấu của bạn" : "Tạo tài khoản & mở phòng"}
      </Link>
      <a className="btn-ghost" href="#phong-dang-mo">
        Xem phòng đang mở →
      </a>
    </div>
  );
}
