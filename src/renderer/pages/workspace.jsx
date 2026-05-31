import { useParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

export function WorkspacePage() {
  const { id } = useParams();

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">
            Workspace {id}
          </h1>
          <Badge>active</Badge>
        </div>
        <p className="text-muted-foreground">
          Manage your workspace members, sessions, and settings.
        </p>
      </div>

      <Separator />

      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Workspace Overview</CardTitle>
              <CardDescription>
                Summary of activity in this workspace
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Workspace #{id} overview content goes here.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="members" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Members</CardTitle>
              <CardDescription>
                People with access to this workspace
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Member list will appear here.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="sessions" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Sessions</CardTitle>
              <CardDescription>
                Active and past collaborative sessions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Session list will appear here.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Workspace Settings</CardTitle>
              <CardDescription>
                Configure workspace preferences
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Workspace settings will appear here.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
