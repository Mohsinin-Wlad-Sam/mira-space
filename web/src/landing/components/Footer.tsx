import { footerLinks } from "../content";
import "./Footer.css";

export default function Footer() {
  return (
    <footer className="site-footer">
      <ul className="site-footer__links">
        {footerLinks.map((l) => (
          <li key={l.href}>
            {l.href.startsWith('/') ? (
              <a href={l.href}>{l.label}</a>
            ) : (
              <a href={l.href} target="_blank" rel="noopener noreferrer">
                {l.label}
              </a>
            )}
          </li>
        ))}
        <li className="site-footer__copy">© 2026 Mira</li>
      </ul>

      <p className="site-footer__credits">
        Every picture on this page was recorded from MIRA itself, on NASA data: SPHEREx, 2MASS and WISE, served by
        NASA/IPAC IRSA; ESA Gaia. A NASA Space Apps Challenge 2026 project, not affiliated with or endorsed by NASA.
      </p>
    </footer>
  );
}
