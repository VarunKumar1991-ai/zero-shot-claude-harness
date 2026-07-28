import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from api._common import api_error, ok
from auth.dependency import get_current_user
from data_sources.registry import get_data_source
from db.models import Dataset
from db.models import DatasetProfile as DatasetProfileRow
from db.models import User
from db.session import get_session
from domain.dataset import (
    ColumnProfile,
    DatasetDetailResponse,
    DatasetListItem,
    DatasetProfile,
    DatasetUploadResponse,
    DateRange,
    QualityIssue,
)
from ingestion.csv_ingest import CsvIngestError, ingest_csv

router = APIRouter(prefix="/datasets", tags=["datasets"])


def _ensure_aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _parse_date_boundary(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)


def _profile_from_row(profile_row: DatasetProfileRow | None, fallback_row_count: int | None) -> DatasetProfile:
    if profile_row is None:
        return DatasetProfile(row_count=fallback_row_count or 0, columns=[], date_range=None, quality_issues=[])

    date_range = None
    if profile_row.date_range_start is not None or profile_row.date_range_end is not None:
        date_range = DateRange(
            start=_ensure_aware(profile_row.date_range_start).date().isoformat()
            if profile_row.date_range_start is not None
            else None,
            end=_ensure_aware(profile_row.date_range_end).date().isoformat()
            if profile_row.date_range_end is not None
            else None,
        )

    return DatasetProfile(
        row_count=profile_row.row_count,
        columns=[ColumnProfile(**c) for c in json.loads(profile_row.columns_json)],
        date_range=date_range,
        quality_issues=[QualityIssue(**q) for q in json.loads(profile_row.quality_issues_json)],
    )


@router.post("/upload")
def upload_dataset(
    file: UploadFile = File(...),
    name: str | None = Form(default=None),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict:
    file_bytes = file.file.read()

    try:
        ingest_result = ingest_csv(file_bytes)
    except CsvIngestError as exc:
        raise api_error("INVALID_FILE", exc.message, 400) from exc

    display_name = (name or file.filename or "dataset.csv").strip() or "dataset.csv"

    dataset = Dataset(
        id=ingest_result.dataset_id,
        name=display_name,
        original_filename=file.filename or "unknown.csv",
        uploaded_by_user_id=user.id,
        status="processing",
        source_type="upload",
        storage_path=ingest_result.storage_path,
        size_bytes=ingest_result.size_bytes,
    )
    session.add(dataset)
    session.flush()

    try:
        data_source = get_data_source()
        base_profile = data_source.profile(ingest_result.storage_path)
        # Merge in the CSV-parse-time date issues detected before coercion —
        # they aren't visible to the DataSource, which only sees the Parquet
        # file after conversion.
        profile = DatasetProfile(
            row_count=base_profile.row_count,
            columns=base_profile.columns,
            date_range=base_profile.date_range,
            quality_issues=[*ingest_result.date_quality_issues, *base_profile.quality_issues],
        )

        profile_row = DatasetProfileRow(
            dataset_id=dataset.id,
            columns_json=json.dumps([c.model_dump() for c in profile.columns]),
            row_count=profile.row_count,
            date_range_start=_parse_date_boundary(profile.date_range.start) if profile.date_range else None,
            date_range_end=_parse_date_boundary(profile.date_range.end) if profile.date_range else None,
            quality_issues_json=json.dumps([q.model_dump() for q in profile.quality_issues]),
        )
        session.add(profile_row)

        dataset.row_count = profile.row_count
        dataset.status = "ready"
        session.flush()
    except Exception as exc:
        session.rollback()
        raise api_error("INGESTION_FAILED", "Failed to profile the uploaded dataset", 500) from exc

    return ok(
        DatasetUploadResponse(
            dataset_id=dataset.id,
            name=dataset.name,
            status=dataset.status,
            profile=profile,
        ).model_dump()
    )


@router.get("")
def list_datasets(
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> dict:
    datasets = session.execute(select(Dataset).order_by(Dataset.created_at.desc())).scalars().all()
    items = []
    for dataset in datasets:
        uploader = session.get(User, dataset.uploaded_by_user_id)
        items.append(
            DatasetListItem(
                dataset_id=dataset.id,
                name=dataset.name,
                row_count=dataset.row_count,
                uploaded_by=uploader.full_name if uploader is not None else "unknown",
                status=dataset.status,
                created_at=_ensure_aware(dataset.created_at).isoformat(),
            ).model_dump()
        )
    return ok(items)


@router.get("/{dataset_id}")
def get_dataset(
    dataset_id: str,
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> dict:
    dataset = session.get(Dataset, dataset_id)
    if dataset is None:
        raise api_error("NOT_FOUND", f"Dataset {dataset_id} not found", 404)

    profile_row = session.get(DatasetProfileRow, dataset_id)
    profile = _profile_from_row(profile_row, dataset.row_count)
    uploader = session.get(User, dataset.uploaded_by_user_id)

    return ok(
        DatasetDetailResponse(
            dataset_id=dataset.id,
            name=dataset.name,
            status=dataset.status,
            profile=profile,
            uploaded_by=uploader.full_name if uploader is not None else "unknown",
            created_at=_ensure_aware(dataset.created_at).isoformat(),
            updated_at=_ensure_aware(dataset.updated_at).isoformat(),
        ).model_dump()
    )
