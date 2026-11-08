export function Icon({
  name,
}: {
  name:
    | "menu"
    | "close"
    | "new"
    | "settings"
    | "file"
    | "chat"
    | "send"
    | "attach"
    | "arrow"
    | "trash";
}) {
  const paths = {
    menu: "M4 6h16M4 12h16M4 18h16",
    close: "m6 6 12 12M6 18 18 6",
    new: "M12 5v14M5 12h14",
    settings:
      "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1",
    file: "M14 3H5v18h14V8l-5-5v5h5M8 12h8M8 16h6",
    chat: "M20 4H4v13h4v4l5-4h7V4Z",
    send: "M12 19V5m-6 6 6-6 6 6",
    attach: "m8 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9",
    arrow: "m15 5-7 7 7 7",
    trash: "M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
  };
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
