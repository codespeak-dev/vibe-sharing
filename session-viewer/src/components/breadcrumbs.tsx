import Link from "next/link";

interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav className="flex items-center gap-1.5 text-sm text-neutral-500 mb-4 flex-wrap">
      {crumbs.map((crumb, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span>/</span>}
          {crumb.href ? (
            <Link href={crumb.href} className="hover:text-neutral-300 transition-colors">
              {crumb.label}
            </Link>
          ) : (
            <span className="text-neutral-300">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
