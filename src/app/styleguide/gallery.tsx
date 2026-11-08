"use client";

import { useState } from "react";
import { ArrowRight, Plus } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge, Button, Card, CardBody, CardFooter, CardHeader, Checkbox, DataList, EmptyState, Field, Input, Modal, PageHeader, Price, RadioCard, Section, Select, Skeleton, Stepper, StickyActionBar, Tabs, Textarea, Toast } from "@/components/ui";

export function Gallery() {
  const [tab, setTab] = useState("overview");
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(true);
  const [error, setError] = useState(false);
  return <main className="page ui-gallery">
    <PageHeader title="Ngôn ngữ sân khấu" subtitle="Thành phần giao diện · phiên bản 01" breadcrumb={<span>Sân Khấu Online / Thư viện giao diện</span>} actions={<ThemeToggle />} />
    <Card><CardBody><Badge tone="warning">Ánh đèn sân khấu</Badge><h2>Một không gian, mọi kết nối</h2><p>Cùng tạo nên những buổi gặp gỡ đáng nhớ.</p><Price amount={150000} /></CardBody></Card>
    <Section title="Nút và trạng thái"><Card><CardBody className="ui-gallery">
      <div className="ui-actions"><Button variant="primary" icon={<Plus aria-hidden />}>Tạo phòng</Button><Button>Quay lại</Button><Button variant="ghost">Xem thêm</Button><Button variant="danger">Xóa phòng</Button></div>
      <div className="ui-actions"><Button size="sm">Nhỏ</Button><Button size="md">Vừa</Button><Button size="lg" icon={<ArrowRight aria-hidden />}>Tiếp tục</Button><Button loading>Đang lưu</Button><Button disabled>Chưa sẵn sàng</Button></div>
    </CardBody></Card></Section>
    <Section title="Biểu mẫu"><Card><CardHeader><h3>Thông tin buổi diễn</h3></CardHeader><CardBody className="ui-gallery-grid">
      <Field label="Tên phòng" hint="Tối đa 120 ký tự"><Input placeholder="Ví dụ: Đêm nhạc mùa thu" /></Field>
      <Field label="Email liên hệ" error={error ? "Nhập email hợp lệ, ví dụ: ten@vidu.vn." : undefined}><Input type="email" placeholder="ten@vidu.vn" onBlur={e => setError(!e.target.validity.valid)} /></Field>
      <Field label="Không gian"><Select defaultValue="hall"><option value="hall">Hội trường</option><option value="meeting">Phòng họp</option></Select></Field>
      <Field label="Ghi chú"><Textarea placeholder="Lời nhắn gửi khách mời" /></Field>
      <Field label="Mã phòng" hint="Được tạo tự động"><Input value="SK-2026" disabled readOnly /></Field>
      <Field label="Số khách" error="Chọn từ 1 đến 100 khách."><Input type="number" defaultValue={0} /></Field>
      <Checkbox defaultChecked>Nhận thông báo sự kiện</Checkbox><Checkbox disabled>Chức năng sắp ra mắt</Checkbox>
      <fieldset><legend>Chọn sân khấu</legend><div className="ui-gallery"><RadioCard name="stage" value="hall" defaultChecked>Hội trường · rộng rãi</RadioCard><RadioCard name="stage" value="meeting">Phòng họp · gần gũi</RadioCard><RadioCard name="stage" value="soon" disabled>Sắp ra mắt</RadioCard></div></fieldset>
    </CardBody><CardFooter><Button onClick={() => setError(true)}>Kiểm tra thông tin</Button></CardFooter></Card></Section>
    <Section title="Điều hướng"><Card><CardBody className="ui-gallery"><Stepper steps={["Không gian", "Thời gian", "Xác nhận"]} current={1} /><Tabs label="Thông tin phòng" value={tab} onChange={setTab} items={[{ value:"overview", label:"Tổng quan", content:<p>Khách mời có thể tham dự qua liên kết.</p> }, { value:"guests", label:"Khách mời", content:<p>Danh sách khách sẽ xuất hiện tại đây.</p> }, { value:"soon", label:"Sắp ra mắt", content:null, disabled:true }]} /></CardBody></Card></Section>
    <Section title="Trạng thái và phản hồi"><div className="ui-actions">{(["neutral","success","warning","danger","info"] as const).map((tone,i) => <Badge key={tone} tone={tone}>{["Bản nháp","Đã xác nhận","Chờ thanh toán","Đã hủy","Thông tin"][i]}</Badge>)}</div>
      {toast ? <Toast tone="success" onClose={() => setToast(false)}>Đã lưu thông tin phòng.</Toast> : <Button onClick={() => setToast(true)}>Hiện thông báo</Button>}
      <Toast tone="danger">Không thể lưu. Vui lòng thử lại.</Toast><Skeleton aria-label="Đang tải danh sách phòng" />
      <Card><EmptyState title="Chưa có khách mời" description="Gửi liên kết để cùng nhau bắt đầu." action={<Button onClick={() => setOpen(true)}>Mời khách</Button>} /></Card>
    </Section>
    <Section title="Danh sách dữ liệu"><Card><CardBody><DataList caption="Đơn gần đây" rows={[{id:"SK001",name:"Đêm nhạc mùa thu",amount:150000},{id:"SK002",name:"Gặp gỡ cuối tuần",amount:80000}]} rowKey={r => r.id} columns={[{key:"name",label:"Sự kiện",render:r => r.name},{key:"amount",label:"Thành tiền",render:r => <Price amount={r.amount} />},{key:"status",label:"Trạng thái",render:() => <Badge tone="success">Đã thanh toán</Badge>}]} /></CardBody></Card></Section>
    <Section title="Hộp thoại và bảng trượt"><p>Hộp thoại trở thành bảng trượt ở màn hình nhỏ. Dùng Escape để đóng.</p><div><Button onClick={() => setOpen(true)}>Mở hộp thoại</Button></div></Section>
    <Modal open={open} onClose={() => setOpen(false)} title="Mời khách tham dự" actions={<Button variant="primary" onClick={() => setOpen(false)}>Xong</Button>}><Field label="Liên kết mời"><Input readOnly value="sankhau.pro.vn/join/DEMO" /></Field><p>Chia sẻ liên kết này với khách mời của bạn.</p></Modal>
    <StickyActionBar><span>Tổng cộng <Price amount={150000} /></span><Button variant="primary" onClick={() => setOpen(true)}>Tiếp tục</Button></StickyActionBar>
  </main>;
}
