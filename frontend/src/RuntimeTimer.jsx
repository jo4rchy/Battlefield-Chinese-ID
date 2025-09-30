// RuntimeTimer.jsx
import { useEffect, useState } from "react";

export default function RuntimeTimer({ since = "2025-09-27T19:00:00+01:00", prefix = "本站已运行 " }) {
  const [text, setText] = useState("");

  useEffect(() => {
    const start = new Date(since);

    const update = () => {
      const now = new Date();
      let diff = Math.max(0, now - start);

      const day = Math.floor(diff / 86400000); diff %= 86400000;
      const hour = Math.floor(diff / 3600000); diff %= 3600000;
      const minute = Math.floor(diff / 60000); diff %= 60000;
      const second = Math.floor(diff / 1000);

      setText(`${prefix}${day}天${hour}小时${minute}分${second}秒`);
    };

    update(); // 先刷新一次
    const id = setInterval(update, 1000);
    return () => clearInterval(id); // 组件卸载时清理
  }, [since, prefix]);

  return <span>{text}</span>;
}
