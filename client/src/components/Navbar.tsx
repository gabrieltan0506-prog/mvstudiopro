import { Link } from "wouter";

export default function Navbar() {
  return (
    <div className="flex items-center justify-end p-4">
      <Link href="/login">
        <button className="px-4 py-2 bg-blue-600 text-white rounded-lg">
          登录
        </button>
      </Link>
    </div>
  );
}
