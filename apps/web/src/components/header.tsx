import { CircleHelp, Menu } from "lucide-react";

export default function Header() {
  return (
    <header className="site-header">
      <a className="brand" href="/" aria-label="ScaleLab home">
        <span className="brand-mark" aria-hidden="true">
          S
        </span>
        <span>ScaleLab</span>
      </a>
      <div className="header-context">
        <span className="header-lab-label">URL shortener</span>
        <span className="header-divider" aria-hidden="true" />
        <span className="header-progress">Lab 01 of 01</span>
      </div>
      <nav aria-label="Secondary navigation">
        <a href="#lab-title">
          <CircleHelp aria-hidden="true" size={17} /> <span>Brief</span>
        </a>
        <button type="button" aria-label="Open lab menu">
          <Menu aria-hidden="true" size={19} />
        </button>
      </nav>
    </header>
  );
}
