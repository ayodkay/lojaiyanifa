import type { RichTextField } from "@prismicio/client";
import { PrismicRichText } from "@prismicio/react";
import type { ComponentProps } from "react";
import { Link } from "react-router";

import { linkResolver } from "~/lib/catalog/links";

function InternalLink({ href, ...rest }: ComponentProps<"a"> & { href: string }) {
  return <Link to={href} {...rest} />;
}

/** Prismic rich text with in-site links routed client-side. Renders nothing for empty fields. */
export function RichText({ field, className }: { field: RichTextField; className?: string }) {
  if (!field || field.length === 0) return null;
  return (
    <div className={className ?? "prose-store"}>
      <PrismicRichText field={field} linkResolver={linkResolver} internalLinkComponent={InternalLink} />
    </div>
  );
}
