// Shim de next/link: âncora simples, mesma superfície de props usada no repo.
import * as React from 'react';

type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
};

const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, prefetch: _p, replace: _r, scroll: _s, ...rest },
  ref,
) {
  return <a ref={ref} href={href} {...rest} />;
});

export default Link;
