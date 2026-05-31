import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const workspaces = [
  { id: "1", name: "Engineering", members: 12, status: "active" },
  { id: "2", name: "Design Team", members: 8, status: "active" },
  { id: "3", name: "Product", members: 6, status: "archived" },
];

export function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome back to Covibe. Here's what's happening.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Workspaces</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{workspaces.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Active Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">3</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Pending Invites</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">2</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Workspaces</CardTitle>
          <CardDescription>
            Your active and archived workspaces
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {workspaces.map((ws) => (
              <div
                key={ws.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="space-y-1">
                  <p className="text-sm font-medium leading-none">{ws.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {ws.members} members
                  </p>
                </div>
                <Badge variant={ws.status === "active" ? "default" : "secondary"}>
                  {ws.status}
                </Badge>
              </div>
            ))}
          </div>
          <Button className="mt-4 w-full" variant="outline">
            Create Workspace
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
