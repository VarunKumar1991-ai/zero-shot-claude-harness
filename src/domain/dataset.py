from pydantic import BaseModel, Field


class ColumnProfile(BaseModel):
    """Per-column profile stats, matching spec/api.md's upload/detail response shape."""

    name: str
    dtype: str  # "string" | "number" | "date" | "boolean"
    null_count: int
    distinct_count: int
    sample_values: list[str] | None = None
    min: str | None = None
    max: str | None = None


class QualityIssue(BaseModel):
    """One detected data-quality problem — never a silent drop, always surfaced."""

    issue_type: str  # "unparseable_date" | "missing_value" | "type_mismatch"
    column: str
    affected_row_count: int
    examples: list[str] = Field(default_factory=list)


class DateRange(BaseModel):
    start: str | None = None
    end: str | None = None


class DatasetProfile(BaseModel):
    """The rich, auto-generated profile — also the `DataSource.profile()` domain
    return type (see `data_sources/base.py`)."""

    row_count: int
    columns: list[ColumnProfile] = Field(default_factory=list)
    date_range: DateRange | None = None
    quality_issues: list[QualityIssue] = Field(default_factory=list)


class DatasetUploadResponse(BaseModel):
    dataset_id: str
    name: str
    status: str
    profile: DatasetProfile


class DatasetListItem(BaseModel):
    dataset_id: str
    name: str
    row_count: int | None
    uploaded_by: str
    status: str
    created_at: str


class DatasetDetailResponse(BaseModel):
    dataset_id: str
    name: str
    status: str
    profile: DatasetProfile
    uploaded_by: str
    created_at: str
    updated_at: str
