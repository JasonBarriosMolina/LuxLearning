"""
migrate-dynamo.py — Copy all DynamoDB prod tables to -Staging and -Test.
Run with: python scripts/migrate-dynamo.py
"""
import boto3
from boto3.dynamodb.types import TypeDeserializer, TypeSerializer
import sys

REGION = "us-east-1"
TABLES = [
    "LessonProgress",
    "QuizAttempts",
    "Reflections",
    "Notifications",
    "Enrollments",
    "Certificates",
    "PushSubscriptions",
    "ScheduledTasks",
    "ReportAnalysis",
    "CurriculumRecommendations",
    "LuxActivity",
    "LuxCertTemplates",
    "LuxResources",
    "LuxChats",
    "LuxMessages",
]
ENVS = ["Staging", "Test"]

client = boto3.client("dynamodb", region_name=REGION)

def scan_all(table_name):
    """Scan full table, return list of raw DynamoDB items (AttributeValue format)."""
    items = []
    kwargs = {"TableName": table_name}
    while True:
        resp = client.scan(**kwargs)
        items.extend(resp.get("Items", []))
        last = resp.get("LastEvaluatedKey")
        if not last:
            break
        kwargs["ExclusiveStartKey"] = last
    return items

def batch_write(table_name, items):
    """Write items to table in batches of 25."""
    written = 0
    for i in range(0, len(items), 25):
        chunk = items[i:i+25]
        requests = [{"PutRequest": {"Item": item}} for item in chunk]
        resp = client.batch_write_item(RequestItems={table_name: requests})
        # Retry unprocessed items once
        unprocessed = resp.get("UnprocessedItems", {}).get(table_name, [])
        if unprocessed:
            client.batch_write_item(RequestItems={table_name: unprocessed})
        written += len(chunk)
    return written

def copy_table(src, dst):
    items = scan_all(src)
    if not items:
        print(f"  {src} -> {dst}: 0 items (skipped)")
        return 0
    n = batch_write(dst, items)
    print(f"  {src} -> {dst}: {n} items OK")
    return n

total = 0
errors = []
for table in TABLES:
    for env in ENVS:
        dst = f"{table}-{env}"
        try:
            total += copy_table(table, dst)
        except Exception as e:
            msg = f"  {table} -> {dst}: ERROR - {e}"
            print(msg, file=sys.stderr)
            errors.append(msg)

print(f"\nMigracion completa. Total items copiados: {total}")
if errors:
    print(f"Errores ({len(errors)}):")
    for e in errors:
        print(e)
