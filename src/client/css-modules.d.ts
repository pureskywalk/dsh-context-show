declare module '*.module.css' {
  /** Compiled CSS-module class map; every local class resolves at build time. */
  const classes: Record<string, string> & { readonly [key: string]: string }
  export default classes
}
