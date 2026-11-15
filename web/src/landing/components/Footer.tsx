import { footerLinks, imageCredits, unsplashHome } from "../content";
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
        Photos:{" "}
        {imageCredits.map((c, i) => (
          <span key={c.href}>
            <a href={c.href} target="_blank" rel="noopener noreferrer">
              {c.author}
            </a>
            {i < imageCredits.length - 1 ? ", " : ""}
          </span>
        ))}{" "}
        on{" "}
        <a href={unsplashHome} target="_blank" rel="noopener noreferrer">
          Unsplash
        </a>
        . Sky data: NASA SPHEREx, 2MASS and WISE, served by NASA/IPAC IRSA; ESA Gaia. A NASA Space Apps Challenge 2026
        project, not affiliated with or endorsed by NASA.
      </p>
    </footer>
  );
}
