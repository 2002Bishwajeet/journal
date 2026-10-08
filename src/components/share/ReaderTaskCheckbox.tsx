/**
 * react-markdown `input` override for the share page (#517). GFM renders a task
 * box disabled and controlled; a reader may tick it. The state is the browser's
 * own (uncontrolled), never saved, and gone on reload.
 */
import type { ComponentProps } from 'react';
import type { ExtraProps } from 'react-markdown';

export function ReaderTaskCheckbox({ node, disabled, checked, ...rest }: ComponentProps<'input'> & ExtraProps) {
  // `node` is react-markdown's own extra prop; `disabled` is what GFM adds.
  void node;
  void disabled;
  return <input {...rest} defaultChecked={checked} />;
}
