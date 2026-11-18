import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const features = [
  { title: "Drag to place", body: "Move any element where it belongs." },
  { title: "Tune the details", body: "Spacing, type and color, in place." },
  { title: "Stay in sync", body: "When your agent edits code, the canvas follows." },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-16">
      <section className="text-center">
        <Badge variant="secondary">New · v2.0</Badge>
        <h1 className="mt-4 text-5xl font-bold tracking-tight">
          Ship interfaces your agent drafted, polished by you.
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          A canvas for the last ten percent.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Button>Get started</Button>
          <Button variant="outline">Read the docs</Button>
        </div>
      </section>

      <section className="mt-16 grid gap-6 sm:grid-cols-3">
        {features.map((f) => (
          <Card key={f.title}>
            <CardHeader>
              <CardTitle>{f.title}</CardTitle>
              <CardDescription>{f.body}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>

      <section className="mt-16">
        <Card className="mx-auto max-w-md">
          <CardHeader>
            <CardTitle>Join the waitlist</CardTitle>
            <CardDescription>We will email you when it is ready.</CardDescription>
          </CardHeader>
          <CardContent>
            <Input placeholder="you@example.com" />
          </CardContent>
          <CardFooter>
            <Button>Notify me</Button>
          </CardFooter>
        </Card>
      </section>
    </main>
  );
}
