import { Toast } from "@base-ui/react/toast";
import { useEffect, useId } from "react";

export function ErrorNotification({ message }: { readonly message: string }) {
  const { add, close } = Toast.useToastManager();
  const id = useId();
  useEffect(() => {
    add({ id, title: message });
    return () => close(id);
  }, [add, close, id, message]);
  return null;
}
