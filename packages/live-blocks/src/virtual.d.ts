// The pieces of a block's page that build/pieces.ts builds as virtual modules; tests alias
// them to test/stubs/.

/** The React a `react` live block runs on, as the text of one script (#426). Built by build/pieces.ts. */
declare module 'virtual:react-block-runtime' {
  const runtime: string;
  export default runtime;
}

/** A react block's Tailwind stylesheet, in Journal's theme (#427). Built by build/pieces.ts. */
declare module 'virtual:react-block-tailwind' {
  const stylesheet: string;
  export default stylesheet;
}

/** Tailwind's theme.css, for the compiler of a react block's own classes (#559). Built by build/pieces.ts. */
declare module 'virtual:react-block-tailwind-theme' {
  const css: string;
  export default css;
}

/** Recharts in Journal's theme for a react block, as the text of a script that sets window.Recharts (#427). */
declare module 'virtual:react-block-recharts' {
  const script: string;
  export default script;
}

/** lucide-react for a react block, as the text of a script that sets window.LucideReact (#427). */
declare module 'virtual:react-block-lucide' {
  const script: string;
  export default script;
}

/** The mermaid a mermaid block runs on, as the text of a script that sets window.mermaid (#946). */
declare module 'virtual:react-block-mermaid' {
  const script: string;
  export default script;
}

/** Any other library a react block can import, as the text of a script that sets its global (REACT_BLOCK_LIBRARIES, #558). */
declare module 'virtual:react-block-*' {
  const script: string;
  export default script;
}
