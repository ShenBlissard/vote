"use client";

import { useState } from "react";
import { copyText } from "@/lib/client";

export function CopyBtn({
  text,
  label = "复制",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`btn btn-sm ${copied ? "btn-ok" : "btn-outline"} ${className ?? ""}`}
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }}
    >
      {copied ? "已复制 ✓" : label}
    </button>
  );
}

export function LinkBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="link-box">
      <div className="card-head">
        <span className="small muted">{label}</span>
        <CopyBtn text={value} />
      </div>
      <div className="link-text">{value}</div>
    </div>
  );
}
