import { getChatGPTUser } from "./chatgpt-auth";
import { PrismAtlas } from "./PrismAtlas";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  return <PrismAtlas user={user ? { displayName: user.displayName, email: user.email } : null} />;
}
