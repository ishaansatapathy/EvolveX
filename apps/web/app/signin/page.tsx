import { Suspense } from "react";

import SignInForm from "./signin-form";

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}
